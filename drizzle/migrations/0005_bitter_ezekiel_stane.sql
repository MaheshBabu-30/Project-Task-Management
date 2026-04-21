ALTER TYPE "public"."notification_type" ADD VALUE 'comment_mentioned' BEFORE 'member_removed';--> statement-breakpoint
CREATE TABLE "comment_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "comment_mentions_unique" UNIQUE("comment_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_mentions_comment_id_idx" ON "comment_mentions" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "comment_mentions_user_id_idx" ON "comment_mentions" USING btree ("user_id");