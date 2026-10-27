import { register } from "node:module";
import "../../../../test/helpers/register-alias-loader.mjs";
register(new URL("./loader.mjs", import.meta.url));
