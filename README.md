# excalidraw-slides
Create slides using Excalidraw.

## Running the server in development

The project includes a backend server. To run the server in development mode with automatic reload, use the npm script:

```
npm run server:dev
```

This runs `server/src/index.ts` via `ts-node-dev`. The server reads the MongoDB connection from the `MONGO_URI` environment variable and the database name from `DB_NAME`.

You can set these directly when running the command:

```
MONGO_URI="mongodb://localhost:27017" DB_NAME="excalidraw_slides" npm run server:dev
```

Or export them first:

```
export MONGO_URI="mongodb://localhost:27017"
export DB_NAME="excalidraw_slides"
npm run server:dev
```

Using a .env file (recommended for local development)

1. Create a `.env` file in the project root with the following contents:

```
MONGO_URI="mongodb://localhost:27017"
DB_NAME="excalidraw_slides"
```

2. The server will automatically load `.env` when started because the project includes `dotenv` and `server/src/index.ts` loads it on startup.

Notes:

- If you are using a hosted MongoDB (MongoDB Atlas), use the connection string provided by the service instead of the local URL.
- For production, keep credentials out of source control and provide environment variables via your deployment platform.
