# Deployment Notes

## Timezone Display

- All post timestamps in the web UI are now displayed in Eastern Time (ET) using Luxon.
- ActivityPub and federation endpoints continue to use UTC/ISO 8601 for compatibility.

## Dependency

- The `luxon` package is required for ET time formatting. Install it with:

  npm install luxon
