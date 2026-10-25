-- Bet on the Horns: one-time Snowflake setup for AI practice opponents.
-- Paste into a Snowsight worksheet as a user with ACCOUNTADMIN. Run the statements
-- one at a time (cursor on a statement, Cmd+Enter): some worksheets run only the
-- statement under the cursor. Steps 1-4 are safe to re-run; run step 5 once.
-- It creates a tiny warehouse with a credit cap, one table + view, and a
-- limited role/user for the game server. The server never gets admin rights.

USE ROLE ACCOUNTADMIN;

-- 1. Compute: extra-small, sleeps after 60 s idle, capped at 10 credits a month.
CREATE WAREHOUSE IF NOT EXISTS HORNS_WH
  WAREHOUSE_SIZE = XSMALL AUTO_SUSPEND = 60 AUTO_RESUME = TRUE INITIALLY_SUSPENDED = TRUE;
CREATE RESOURCE MONITOR IF NOT EXISTS HORNS_MONITOR
  WITH CREDIT_QUOTA = 10 FREQUENCY = MONTHLY START_TIMESTAMP = IMMEDIATELY
  TRIGGERS ON 80 PERCENT DO NOTIFY ON 100 PERCENT DO SUSPEND;
ALTER WAREHOUSE HORNS_WH SET RESOURCE_MONITOR = HORNS_MONITOR;

-- 2. Data: one small row per player per finished game, rolled up into a style view.
CREATE DATABASE IF NOT EXISTS HORNS;
CREATE SCHEMA IF NOT EXISTS HORNS.POKER;
CREATE TABLE IF NOT EXISTS HORNS.POKER.PLAYER_GAME_STATS (
  WALLET        STRING  NOT NULL,
  MODE          STRING  NOT NULL,   -- heads_up | four | six
  RANKED        BOOLEAN NOT NULL,
  HANDS         INTEGER,            -- hands dealt to the player
  VPIP          INTEGER,            -- hands they voluntarily put chips in preflop
  PFR           INTEGER,            -- hands they raised preflop
  AGGRESSIVE    INTEGER,            -- bets + raises
  PASSIVE       INTEGER,            -- calls
  SAW_FLOP      INTEGER,
  SHOWDOWNS     INTEGER,
  SHOWDOWNS_WON INTEGER,
  PLACE         INTEGER,
  PLAYERS       INTEGER,
  PLAYED_AT     TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);
CREATE OR REPLACE VIEW HORNS.POKER.PLAYER_STYLE AS
  SELECT WALLET,
         SUM(HANDS)                                   AS HANDS,
         SUM(VPIP) / NULLIF(SUM(HANDS), 0)            AS VPIP,
         SUM(PFR) / NULLIF(SUM(HANDS), 0)             AS PFR,
         SUM(AGGRESSIVE) / GREATEST(SUM(PASSIVE), 1)  AS AGGRESSION
  FROM HORNS.POKER.PLAYER_GAME_STATS
  WHERE PLAYED_AT > DATEADD(day, -90, CURRENT_TIMESTAMP())
  GROUP BY WALLET;

-- 3. A narrow role and service user for the game server.
CREATE ROLE IF NOT EXISTS HORNS_APP;
GRANT USAGE ON WAREHOUSE HORNS_WH TO ROLE HORNS_APP;
GRANT USAGE ON DATABASE HORNS TO ROLE HORNS_APP;
GRANT USAGE ON SCHEMA HORNS.POKER TO ROLE HORNS_APP;
GRANT SELECT, INSERT ON TABLE HORNS.POKER.PLAYER_GAME_STATS TO ROLE HORNS_APP;
GRANT SELECT ON VIEW HORNS.POKER.PLAYER_STYLE TO ROLE HORNS_APP;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE HORNS_APP;   -- Cortex AI models

CREATE USER IF NOT EXISTS HORNS_SERVICE
  TYPE = SERVICE DEFAULT_ROLE = HORNS_APP DEFAULT_WAREHOUSE = HORNS_WH
  COMMENT = 'Bet on the Horns game server';
GRANT ROLE HORNS_APP TO USER HORNS_SERVICE;

-- Tokens normally require a network policy. This lets the token work without one
-- (simplest for a hackathon). For production, add a network policy for your server's IPs.
CREATE AUTHENTICATION POLICY IF NOT EXISTS HORNS.POKER.HORNS_PAT_POLICY
  PAT_POLICY = (NETWORK_POLICY_EVALUATION = ENFORCED_NOT_REQUIRED);
-- A user can hold only one policy; unset first so this script is safe to re-run.
ALTER USER HORNS_SERVICE UNSET AUTHENTICATION POLICY;
ALTER USER HORNS_SERVICE SET AUTHENTICATION POLICY HORNS.POKER.HORNS_PAT_POLICY;

-- 4. Optional: many trial regions don't host every model. This lets Cortex route to
--    another region (same price). Uncomment if a persona's model reports "unavailable".
-- ALTER ACCOUNT SET CORTEX_ENABLED_CROSS_REGION = 'ANY_REGION';

-- 5. The token for server/.env. Copy the TOKEN_SECRET from the result; it is shown once.
ALTER USER HORNS_SERVICE ADD PROGRAMMATIC ACCESS TOKEN HORNS_SERVER_TOKEN
  ROLE_RESTRICTION = 'HORNS_APP' DAYS_TO_EXPIRY = 30;

-- 6. Your account identifier for server/.env (SNOWFLAKE_ACCOUNT).
SELECT CURRENT_ORGANIZATION_NAME() || '-' || CURRENT_ACCOUNT_NAME() AS SNOWFLAKE_ACCOUNT;
