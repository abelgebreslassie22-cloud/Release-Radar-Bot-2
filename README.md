# Movie Radar

Movie Radar is a complete, production-ready full-stack application designed to monitor movie and television release information from configurable data providers and notify users when watched titles receive new official releases or metadata updates.

## Features
- **Dashboard**: High-level overview of system health and monitored content.
- **Watchlist**: Track movies, series, and anime with specific release types.
- **Automated Scanning**: A robust background scheduler (`node-cron`) periodically scans configured providers.
- **Releases**: View the latest detected releases matched against your watchlist, complete with enriched TMDB metadata (posters, ratings, genres, plot overview, directors, cast).
- **Telegram Notifications**: Get instant push notifications right to your Telegram when a release is found.
- **Settings**: Manage scanner intervals, your Telegram Chat ID, and your TMDB API key from the UI.
- **PostgreSQL Database**: Uses Drizzle ORM for robust and type-safe database queries.
- **Modern UI**: Polished, accessible, and responsive user interface built with React, Tailwind CSS, and Lucide Icons.

## Tech Stack
- **Backend**: Node.js, Express, TypeScript, Drizzle ORM, node-cron
- **Frontend**: React, Vite, Tailwind CSS, motion
- **Database**: PostgreSQL
- **Deployment**: Render (Docker)

## Environment Variables
The application requires the following environment variables to run properly:

```env
DATABASE_URL="postgresql://user:password@host:port/dbname"
TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
```

*Note: OMDb API Key and Telegram Chat ID are configured directly within the application's Settings UI and stored in the database.*

## Getting Started

### 1. Database Setup
Ensure you have a PostgreSQL database running. Configure `DATABASE_URL`.

### 2. Install Dependencies
```bash
npm install
```

### 3. Initialize Database Schema
```bash
npm run db:push
```

### 4. Start Development Server
```bash
npm run dev
```
The application will be accessible at `http://localhost:3000`.

## Production Deployment (Render)
This project is configured to deploy as a single containerized service on Render using the provided `render.yaml` and `Dockerfile`.
The backend uses ESBuild to bundle the server, ensuring rapid cold-starts and clean deployment.

## Architecture
- `src/api/` - REST API controllers and routing logic.
- `src/components/` - Reusable React components and UI views.
- `src/database/` - Drizzle ORM schema and database connection logic.
- `src/scheduler/` - Background cron jobs and interval management.
- `src/services/` - Core business logic, such as the scanning engine.
- `src/providers/` - Extensible data source fetchers.
- `src/metadata/` - Integration with external metadata APIs (e.g., OMDb).
- `src/telegram/` - Telegram bot integration for real-time notifications.
