import { Router } from "express";
import { StatsController } from "../controllers/statsController";

const router = Router();
const controller = new StatsController();

router.get("/", (req, res) => controller.get(req, res));

export default router;
