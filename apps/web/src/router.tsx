import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { HomePage } from "./routes/home";
import { LoginsPage } from "./routes/logins";
import { PairPage } from "./routes/pair";

const rootRoute = createRootRoute({ component: Outlet });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/pair", component: PairPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/logins", component: LoginsPage }),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
