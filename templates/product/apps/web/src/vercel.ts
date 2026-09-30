/** Vercel function entry for wOS Web (app.waronsaas.com). */
import { bootWeb } from "./boot.js";

export default bootWeb(process.env);
