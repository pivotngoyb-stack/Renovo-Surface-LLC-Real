CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY,
	"key" text NOT NULL,
	"attempted_at" timestamp DEFAULT now() NOT NULL
);
