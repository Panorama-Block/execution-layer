import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import swaggerDoc from "./docs/swagger.json";
import { swapProviderRoutes }  from "./routes/swap-provider.routes";
import { stakingRoutes }        from "./modules/liquid-staking/routes/staking.routes";
import { swapRoutes }           from "./modules/swap/routes/swap.routes";
import { dcaRoutes }            from "./modules/dca/routes/dca.routes";
import { avaxSwapRoutes }       from "./modules/avax-swap/routes/avax-swap.routes";
import { avaxLendingRoutes }         from "./modules/avax-lending/routes/avax-lending.routes";
import { avaxLpRoutes }              from "./modules/avax-lp/routes/avax-lp.routes";
import { avaxLiquidStakingRoutes }   from "./modules/avax-liquid-staking/routes/avax-liquid-staking.routes";
import { moonwellLendingRoutes }     from "./modules/moonwell-lending/routes/moonwell-lending.routes";
import { errorHandler }              from "./middleware/errorHandler";
import { rateLimiter } from "./middleware/rateLimiter";
import { serializeByUser } from "./middleware/serialize-by-user";
import { tracingMiddleware } from "./middleware/tracing";
import { logger } from "./shared/logger";

const app = express();
const PORT = process.env.PORT || 3010;

// CORS — restrict to allowlisted origins in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["http://localhost:3000", "http://localhost:3010", "http://localhost:7777"];

app.use(helmet());
app.use(tracingMiddleware);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimiter);
app.use(serializeByUser);

// Swagger only in non-production environments
if (process.env.NODE_ENV !== "production") {
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "PanoramaBlock API Docs",
  }));
}

app.use("/provider/swap", swapProviderRoutes); // External Liquid Swap Service adapter
app.use("/staking", stakingRoutes);
app.use("/swap", swapRoutes);
app.use("/dca", dcaRoutes);
app.use("/avax/swap", avaxSwapRoutes);
app.use("/avax/lending", avaxLendingRoutes);
app.use("/avax/lp", avaxLpRoutes);
app.use("/avax/liquid-staking", avaxLiquidStakingRoutes);
app.use("/base/lending", moonwellLendingRoutes);

// Cloud reverse proxy may forward with /execution prefix without stripping it.
// Mount all routes under /execution/* so both paths work.
app.use("/execution/provider/swap", swapProviderRoutes);
app.use("/execution/staking", stakingRoutes);
app.use("/execution/swap", swapRoutes);
app.use("/execution/dca", dcaRoutes);
app.use("/execution/avax/swap", avaxSwapRoutes);
app.use("/execution/avax/lending", avaxLendingRoutes);
app.use("/execution/avax/lp", avaxLpRoutes);
app.use("/execution/avax/liquid-staking", avaxLiquidStakingRoutes);
app.use("/execution/base/lending", moonwellLendingRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "execution-service", port: PORT });
});

// Global error handler — must be registered AFTER routes
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info({ port: PORT }, `execution-service running on port ${PORT}`);
});

export default app;
