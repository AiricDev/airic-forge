import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

/** Only a validated App material result can provide pixels. No remote URL loading. */
export function materialToolContent(result: Record<string, unknown>, supportsImages: boolean): Array<TextContent | ImageContent> {
  const { image, ...metadata } = result;
  const value = image as { mimeType: string; data: string } | undefined;
  return [
    { type: "text", text: JSON.stringify({ ...metadata, referenceData: true,
      ...(value ? { imageInputStatus: supportsImages ? "provided" : "unsupported_by_model",
        ...(!supportsImages ? { limitation: "This model cannot inspect the image. Ask for human review; absence of readable text is not conformity." } : {}) } : { imageInputStatus: "not_requested_or_unavailable", limitation: "No image pixels were supplied. Request include_image=true before visual verification; a text fragment is not a full-page inspection." }) }) },
    ...(value && supportsImages ? [{ type: "image" as const, mimeType: value.mimeType, data: value.data }] : []),
  ];
}
