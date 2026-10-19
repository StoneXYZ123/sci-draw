CREATE TABLE "upload_object" (
	"id" text PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"sha256" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_object_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "upload_object" ADD CONSTRAINT "upload_object_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_object_user_id_idx" ON "upload_object" USING btree ("user_id");