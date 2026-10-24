import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/db/schema";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      permissions: string[];
    } & DefaultSession["user"];
  }
}
