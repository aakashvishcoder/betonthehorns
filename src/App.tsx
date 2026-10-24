import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "next-themes";
import { PokerMotionProvider } from "@/components/poker-app/PokerAppShell";
import Home from "./pages/Home";
import CoachWidget from "@/components/coach/CoachWidget";

const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const PlayPage = lazy(() => import("./pages/PlayPage"));
const TablePage = lazy(() => import("./pages/TablePage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem={false}
        storageKey="allin-violet-theme"
      >
        <TooltipProvider>
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
                <Route path="/profile">
                  <ProfilePage />
                </Route>
                <Route path="/play">
                  <PlayPage />
                </Route>
                <Route path="/table">
                  <TablePage />
                </Route>
                <Route path="/leaderboard">
                  <LeaderboardPage />
                </Route>
                <Route path="/404" component={NotFound} />
                <Route component={NotFound} />
              </Switch>
            </Suspense>
            <CoachWidget />
          </PokerMotionProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
