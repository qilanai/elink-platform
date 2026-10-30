import { create } from "zustand";
import type { ThemeName } from "@/stores/use-theme-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useLayoutEffect } from "react";

type CanvasThemeStore = { theme: ThemeName; active: boolean; setTheme: (theme: ThemeName) => void };

/** 主题由当前画布外观解析，不持久化上一张画布的主题，也不改写工作台偏好。 */
export const useCanvasThemeStore = create<CanvasThemeStore>()((set) => ({
    theme: useThemeStore.getState().theme,
    active: false,
    setTheme: (theme) => { if (theme === "light" || theme === "dark") set({ theme }); },
}));

/** 编辑器卸载后自动恢复工作台的主题偏好；包括 body 上的 AntD 浮层。 */
export function useCanvasThemeScope() {
    useLayoutEffect(() => {
        useCanvasThemeStore.setState({ active: true, theme: useThemeStore.getState().theme });
        return () => { useCanvasThemeStore.setState({ active: false }); };
    }, []);
}

export function useActiveTheme() {
    const workspaceTheme = useThemeStore((state) => state.theme);
    const canvasTheme = useCanvasThemeStore((state) => state.theme);
    const active = useCanvasThemeStore((state) => state.active);
    return active ? canvasTheme : workspaceTheme;
}
