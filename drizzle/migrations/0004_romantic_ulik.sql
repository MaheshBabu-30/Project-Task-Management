ALTER TABLE "comments" ADD COLUMN "parent_comment_id" uuid;--> statement-breakpoint
CREATE INDEX "comments_parent_comment_id_idx" ON "comments" USING btree ("parent_comment_id");