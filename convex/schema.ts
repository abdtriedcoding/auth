import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    passwordHash: v.string(),
  }).index("by_email", ["email"]),

  tasks: defineTable({
    text: v.string(),
    isCompleted: v.boolean(),
  }),
});
