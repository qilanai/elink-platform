import type { ReactNode } from "react";
import { NavLink } from "react-router";
import type { WorkspaceModule } from "./modules";

// Cross-app entries need a document navigation; local modules share the workspace router.
export default function ModuleLink({ module, className, children }: {
  module: WorkspaceModule;
  className: string;
  children: ReactNode;
}) {
  if ("href" in module) return <a href={module.href} className={className}>{children}</a>;
  return <NavLink to={module.path} end className={({ isActive }) => `${className}${isActive ? " active" : ""}`}>{children}</NavLink>;
}
