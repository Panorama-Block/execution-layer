import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { executionRoutes } from "./routes/execution.routes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3010;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use("/execution", executionRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "execution-service", port: PORT });
});

app.listen(PORT, () => {
  console.log(`execution-service running on port ${PORT}`);
});

export default app;
