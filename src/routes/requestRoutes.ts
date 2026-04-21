import { Router } from "express";
import { RequestController } from "../controllers/requestController";

const router = Router();
const controller = new RequestController();

router.post("/", (req, res) => controller.submit(req, res));

export default router;
