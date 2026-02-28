# FinFlow — Transaction Intelligence Dashboard

A personal finance dashboard with statistical anomaly detection and ML spend forecasting.

**Live Demo:** https://finflow-n14yrbfp5-sohamgugales-projects.vercel.app

## Features
- Z-score anomaly detection flags unusual transactions (>2.2σ from category mean)
- ML spend forecasting via 6-month linear trend extrapolation
- Real-time budget tracking with burn-rate alerts
- Daily cumulative spend visualization
- Full CRUD: add transactions, edit budgets

## Tech Stack
React 18 · Vite · Recharts · Custom analytics engine

## Run Locally
\`\`\`bash
npm install
npm run dev
\`\`\`
