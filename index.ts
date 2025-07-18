import fastifyCookie from "@fastify/cookie";
import fastifyView from "@fastify/view";
import Fastify from "fastify";
const { Liquid } = require("liquidjs");
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fastifyFormbody from "@fastify/formbody";
import fastifyJwt from "@fastify/jwt";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { client, db } from "./lib/db";
import logger from "./lib/logger";
import { migrationHelper } from "./lib/migration";
import { printInfo } from "./lib/utils";
import { routesRoot } from "./routes/root";
import { routesUser } from "./routes/user";

declare module "@fastify/jwt" {
	interface FastifyJWT {
		user: {
			id: string;
			mastodonHandle: string;
			token: string;
			instance: string;
		};
	}
}

export const app = Fastify({
	logger: true,
});

client.connect();

migrationHelper()
	.then(() => {
		const { ADDRESS = "localhost", PORT = "3000" } = process.env;

		// Load JWT secret from env or mounted secret file
		const jwtSecret =
			process.env.JWT_SECRET ||
			(existsSync("/run/secrets/jwt_secret")
				? readFileSync("/run/secrets/jwt_secret", "utf-8").trim()
				: "this_shoudl_not_be_used_in_production");

		if (process.env.SENTRY_DSN) {
			Sentry.init({
				dsn: process.env.SENTRY_DSN,
				integrations: [nodeProfilingIntegration()],
				tracesSampleRate: 1.0,
				profilesSampleRate: 1.0,
			});
		}

		let version = "development";

		const gitRevPath = join(__dirname, ".git-rev");
		if (existsSync(gitRevPath)) {
			version = readFileSync(gitRevPath, "utf-8").trim();
		}

		app.register(fastifyCookie);
		app.register(fastifyFormbody);
		app.register(fastifyView, {
			engine: {
				liquid: new Liquid({
					root: join(__dirname, "views"),
					extname: ".liquid",
					globals: {
						version,
					},
				}),
			},
			root: join(__dirname, "views"),
			production: false,
			maxCache: 0,
			options: {
				noCache: true,
			},
		});

		app.register(require("@fastify/static"), {
			root: join(__dirname, "public"),
		});

		app.register(fastifyJwt, {
			secret: jwtSecret,
			cookie: {
				cookieName: "token",
				signed: false,
			},
		});

		app.register(routesRoot);
		app.register(routesUser);

		app.listen(
			{ host: ADDRESS, port: Number.parseInt(PORT, 10) },
			(err, address) => {
				if (err) {
					app.log.error(err);
				}
			},
		);

		printInfo();
	})
	.catch((err) => {
		logger.error(err);
	});
