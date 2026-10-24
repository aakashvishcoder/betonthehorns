//! Runs the full match flow against the program deployed on devnet.
//! Skipped by default; run with:
//!   cargo test -p horns_elo --test devnet -- --ignored --nocapture
//! Needs ~/.config/solana/id.json (deployer, funded) and
//! ~/.config/solana/horns-elo-server.json (game server key).

use {
    anchor_lang::{
        prelude::{AccountMeta, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    horns_elo::{
        constants::{CONFIG_SEED, MATCH_SEED, PLAYER_SEED},
        state::{Config, Match, PlayerRating},
    },
    solana_commitment_config::CommitmentConfig,
    solana_keypair::{read_keypair_file, Keypair},
    solana_rpc_client::rpc_client::RpcClient,
    solana_sha256_hasher::hash,
    solana_signer::Signer,
    solana_transaction::Transaction,
};

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &horns_elo::id()).0
}

fn ix<A: ToAccountMetas, D: InstructionData>(accounts: A, data: D, extra: Vec<AccountMeta>) -> Instruction {
    let mut metas = accounts.to_account_metas(None);
    metas.extend(extra);
    Instruction::new_with_bytes(horns_elo::id(), &data.data(), metas)
}

/// System-program transfer, built by hand to avoid another dependency.
fn transfer(from: Pubkey, to: Pubkey, lamports: u64) -> Instruction {
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend(lamports.to_le_bytes());
    Instruction::new_with_bytes(
        system_program::ID,
        &data,
        vec![AccountMeta::new(from, true), AccountMeta::new(to, false)],
    )
}

fn send(rpc: &RpcClient, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) -> Result<String, String> {
    let mut all: Vec<&Keypair> = vec![payer];
    all.extend(signers.iter().filter(|s| s.pubkey() != payer.pubkey()));
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&payer.pubkey()),
        &all,
        rpc.get_latest_blockhash().map_err(|e| e.to_string())?,
    );
    rpc.send_and_confirm_transaction(&tx)
        .map(|sig| sig.to_string())
        .map_err(|e| format!("{e:?}"))
}

fn read<T: AccountDeserialize>(rpc: &RpcClient, key: Pubkey) -> Option<T> {
    let account = rpc.get_account(&key).ok()?;
    T::try_deserialize(&mut account.data.as_slice()).ok()
}

fn ok(label: &str, result: Result<String, String>) {
    let sig = result.unwrap_or_else(|e| panic!("{label} failed: {e}"));
    println!("  ✓ {label}\n    https://explorer.solana.com/tx/{sig}?cluster=devnet");
}

/// Expects the transaction to fail with the given program error code.
fn rejected(label: &str, result: Result<String, String>, code: u32) {
    match result {
        Ok(sig) => panic!("{label} should have failed but landed: {sig}"),
        Err(e) => {
            assert!(e.contains(&format!("Custom({code})")), "{label}: wrong error: {e}");
            println!("  ✓ {label} (rejected with error {code})");
        }
    }
}

#[test]
#[ignore = "hits devnet"]
fn devnet_match_flow() {
    let url = std::env::var("DEVNET_URL").unwrap_or("https://api.devnet.solana.com".into());
    let rpc = RpcClient::new_with_commitment(url, CommitmentConfig::confirmed());
    let home = std::env::var("HOME").unwrap();
    let deployer = read_keypair_file(format!("{home}/.config/solana/id.json")).unwrap();
    let server = read_keypair_file(format!("{home}/.config/solana/horns-elo-server.json")).unwrap();

    let program = rpc.get_account(&horns_elo::id()).expect("program not deployed on devnet");
    assert!(program.executable);
    println!("program {} is deployed", horns_elo::id());

    // Config: create once, then reuse on later runs.
    let config_key = pda(&[CONFIG_SEED]);
    if read::<Config>(&rpc, config_key).is_none() {
        ok(
            "initialize config",
            send(
                &rpc,
                &[ix(
                    horns_elo::accounts::Initialize {
                        admin: deployer.pubkey(),
                        config: config_key,
                        system_program: system_program::ID,
                    },
                    horns_elo::instruction::Initialize { result_authority: server.pubkey() },
                    vec![],
                )],
                &deployer,
                &[],
            ),
        );
    }
    let config: Config = read(&rpc, config_key).unwrap();
    assert_eq!(config.result_authority, server.pubkey());

    // Fresh players each run; the deployer funds their rent and the server's match rent.
    let players: Vec<Keypair> = (0..3).map(|_| Keypair::new()).collect();
    let wallets: Vec<Pubkey> = players.iter().map(|p| p.pubkey()).collect();
    let mut funding: Vec<Instruction> = wallets
        .iter()
        .map(|w| transfer(deployer.pubkey(), *w, LAMPORTS_PER_SOL / 100))
        .collect();
    if rpc.get_balance(&server.pubkey()).unwrap() < LAMPORTS_PER_SOL / 50 {
        funding.push(transfer(deployer.pubkey(), server.pubkey(), LAMPORTS_PER_SOL / 20));
    }
    ok("fund 3 test players (+ server if low)", send(&rpc, &funding, &deployer, &[]));

    let player_key = |w: &Pubkey| pda(&[PLAYER_SEED, w.as_ref()]);
    for (i, p) in players.iter().enumerate() {
        let register = ix(
            horns_elo::accounts::RegisterPlayer {
                wallet: p.pubkey(),
                player: player_key(&p.pubkey()),
                system_program: system_program::ID,
            },
            horns_elo::instruction::RegisterPlayer {},
            vec![],
        );
        ok(&format!("register player {i}"), send(&rpc, &[register], &deployer, &[p]));
    }

    let id = config.match_count;
    let game_key = pda(&[MATCH_SEED, &id.to_le_bytes()]);
    let seed: [u8; 32] = Keypair::new().pubkey().to_bytes(); // random 32 bytes
    let create = |signer: &Keypair, players: Vec<Pubkey>| {
        ix(
            horns_elo::accounts::CreateMatch {
                result_authority: signer.pubkey(),
                config: config_key,
                game: game_key,
                system_program: system_program::ID,
            },
            horns_elo::instruction::CreateMatch { players, seed_commitment: hash(&seed).to_bytes() },
            vec![],
        )
    };
    rejected(
        "create match signed by a non-server key",
        send(&rpc, &[create(&deployer, wallets.clone())], &deployer, &[]),
        6000,
    );
    rejected(
        "create match with a duplicate player",
        send(&rpc, &[create(&server, vec![wallets[0], wallets[0]])], &server, &[]),
        6002,
    );
    ok(&format!("create match #{id}"), send(&rpc, &[create(&server, wallets.clone())], &server, &[]));

    let settle = |signer: &Keypair, order: &[Pubkey], places: Vec<u8>, reveal: [u8; 32]| {
        ix(
            horns_elo::accounts::SettleMatch {
                result_authority: signer.pubkey(),
                config: config_key,
                game: game_key,
            },
            horns_elo::instruction::SettleMatch {
                places,
                revealed_seed: reveal,
                chip_counts_hash: hash(b"final chip counts").to_bytes(),
            },
            order.iter().map(|w| AccountMeta::new(player_key(w), false)).collect(),
        )
    };
    rejected(
        "settle with the wrong seed",
        send(&rpc, &[settle(&server, &wallets, vec![2, 1, 3], [0; 32])], &server, &[]),
        6006,
    );
    rejected(
        "settle signed by a non-server key",
        send(&rpc, &[settle(&deployer, &wallets, vec![2, 1, 3], seed)], &deployer, &[]),
        6000,
    );
    let swapped = [wallets[1], wallets[0], wallets[2]];
    rejected(
        "settle with player accounts out of order",
        send(&rpc, &[settle(&server, &swapped, vec![2, 1, 3], seed)], &server, &[]),
        6005,
    );
    ok("settle match (player 1 wins)", send(&rpc, &[settle(&server, &wallets, vec![2, 1, 3], seed)], &server, &[]));

    let ratings: Vec<PlayerRating> = wallets.iter().map(|w| read(&rpc, player_key(w)).unwrap()).collect();
    let values: Vec<u32> = ratings.iter().map(|r| r.rating).collect();
    println!("  ratings after match: {values:?}");
    assert_eq!(values, vec![1200, 1216, 1184]);
    assert_eq!(ratings.iter().map(|r| (r.games, r.wins)).collect::<Vec<_>>(), vec![(1, 0), (1, 1), (1, 0)]);

    let game: Match = read(&rpc, game_key).unwrap();
    assert!(game.settled && game.revealed_seed == seed && game.places == vec![2, 1, 3]);
    println!("  match #{id} settled; seed reveal matches its commitment");

    rejected(
        "settle the same match twice",
        send(&rpc, &[settle(&server, &wallets, vec![1, 2, 3], seed)], &server, &[]),
        6003,
    );
}
