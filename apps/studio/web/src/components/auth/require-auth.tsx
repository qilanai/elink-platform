import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { useUserStore } from "@/stores/use-user-store";
import { newAPIHosted } from "@/services/new-api-session";

export function RequireAuth({ children, allowAnonymous = false }: { children: ReactNode; allowAnonymous?: boolean }) {
    const location = useLocation();
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);

    if (!hydrated) return <FullScreenLoader />;
    if (newAPIHosted && !user) return <div role="alert" className="p-8">无法连接当前账号。<a href="/apps">返回应用中心</a></div>;
    if (!user && !allowAnonymous) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    return children;
}
