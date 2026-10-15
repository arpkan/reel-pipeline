import "dotenv/config";
import { clearLineEvents } from "../src/db/queries.js";

clearLineEvents();
console.log("line_events table cleared.");
