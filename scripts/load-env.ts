import { config } from "dotenv";

// Same precedence as Next.js for local scripts; Vercel injects real env vars directly.
config({ path: [".env.local", ".env"], quiet: true });
