// Display metadata for change types, shared by UI, notifications and email.
import type { ChangeType } from "./models";

export const CHANGE_META: Record<
  ChangeType,
  { icon: string; label: string; plural: string; sign: "+" | "-" | ""; tone: "add" | "remove" | "edit" | "price" }
> = {
  new_page: { icon: "+", label: "New Page", plural: "New Pages", sign: "+", tone: "add" },
  new_blog: { icon: "✍️", label: "New Blog", plural: "New Blogs", sign: "+", tone: "add" },
  new_product: { icon: "📦", label: "New Product/Package", plural: "New Products/Packages", sign: "+", tone: "add" },
  deleted_page: { icon: "−", label: "Deleted Page", plural: "Deleted Pages", sign: "-", tone: "remove" },
  price_change: { icon: "💰", label: "Price Change", plural: "Price Changes", sign: "", tone: "price" },
  content_change: { icon: "📝", label: "Content Change", plural: "Content Changes", sign: "", tone: "edit" },
  title_change: { icon: "🏷️", label: "Title Change", plural: "Title Changes", sign: "", tone: "edit" },
  meta_change: { icon: "📄", label: "Meta Description Change", plural: "Meta Description Changes", sign: "", tone: "edit" },
  heading_change: { icon: "🔤", label: "H1/H2 Change", plural: "H1/H2 Changes", sign: "", tone: "edit" },
  internal_link_added: { icon: "🔗", label: "New Internal Link", plural: "New Internal Links", sign: "+", tone: "add" },
  internal_link_removed: { icon: "❌", label: "Deleted Internal Link", plural: "Deleted Internal Links", sign: "-", tone: "remove" },
  image_change: { icon: "🖼️", label: "Image Change", plural: "Image Changes", sign: "", tone: "edit" },
  seo_change: { icon: "🔍", label: "SEO Change", plural: "SEO Changes", sign: "", tone: "edit" },
};

/** Order used in summaries: most important first. */
export const CHANGE_ORDER: ChangeType[] = [
  "new_page",
  "new_blog",
  "new_product",
  "deleted_page",
  "price_change",
  "seo_change",
  "title_change",
  "meta_change",
  "heading_change",
  "content_change",
  "internal_link_added",
  "internal_link_removed",
  "image_change",
];

/** e.g. ["+3 New Pages", "+1 Price Change", "+12 New Internal Links"] */
export function summaryLines(counts: Partial<Record<ChangeType, number>>): string[] {
  return CHANGE_ORDER.filter((t) => (counts[t] ?? 0) > 0).map((t) => {
    const n = counts[t]!;
    const meta = CHANGE_META[t];
    const sign = meta.sign || "";
    return `${sign}${n} ${n === 1 ? meta.label : meta.plural}`;
  });
}
