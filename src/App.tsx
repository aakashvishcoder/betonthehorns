import { lazy, Suspense, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "next-themes";
import { PokerMotionProvider } from "@/components/poker-app/PokerAppShell";
import RequireAuth from "@/components/auth/RequireAuth";
import { AuthProvider } from "@/lib/auth";
import { isGameModeId } from "@/lib/game-modes";
import Home from "./pages/Home";
import CoachWidget from "@/components/coach/CoachWidget";

const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const PlayPage = lazy(() => import("./pages/PlayPage"));
const QueuePage = lazy(() => import("./pages/QueuePage"));
const TablePage = lazy(() => import("./pages/TablePage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const PuzzlesPage = lazy(() => import("./pages/PuzzlesPage"));

function Protected({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem={false}
        storageKey="betonthehorns-theme"
      >
        <TooltipProvider>
          <AuthProvider>
            <PokerMotionProvider>
              <Toaster />
              <Suspense
                fallback={
                  <div className="club-loading" role="status">
                    Dealing the next page…
                  </div>
                }
              >
                <Switch>
                  <Route path="/" component={Home} />
                  <Route path="/profile/:address">
                    <ProfilePage />
                  </Route>
                  <Route path="/profile">
                    <ProfilePage />
                  </Route>
                  <Route path="/leaderboard">
                    <LeaderboardPage />
                  </Route>
                  <Route path="/puzzles">
                    <PuzzlesPage />
                  </Route>
                  <Route path="/play">
                    <Protected>
                      <PlayPage />
                    </Protected>
                  </Route>
                  <Route path="/queue/:mode">
                    {(params) =>
                      params.mode && isGameModeId(params.mode) ? (
                        <Protected>
                          <QueuePage />
                        </Protected>
                      ) : (
                        <NotFound />
                      )
                    }
                  </Route>
                  <Route path="/table/:matchId">
                    <Protected>
                      <TablePage />
                    </Protected>
                  </Route>
                  <Route path="/404" component={NotFound} />
                  <Route component={NotFound} />
                </Switch>
              </Suspense>
              <CoachWidget />
            </PokerMotionProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
