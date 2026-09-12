import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: {
		url: (process.env.DATABASE_URL || './.data/sparkprint.db').replace(/^file:/, '')
	},
	verbose: true,
	strict: true
});
