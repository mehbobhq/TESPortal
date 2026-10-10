// Side-effect module for authorization tests: installs the existing "@/" alias loader, then the auth stand-ins.
// Hooks registered later run first, so the stand-ins take precedence over the alias resolution.
import { register } from "node:module";
import "./register-alias-loader.mjs";

register(new URL("./auth-test-loader.mjs", import.meta.url));
