import { defineSchema } from "../../core/schema";

export const viewSettings = defineSchema({
  tintHome: { type: "bool", label: "tint tiles that are in their final spot (and upright, where that matters)", default: true },
  showBlock: { type: "bool", label: "outline the block a click would turn (turning blocks)", default: true },
});
