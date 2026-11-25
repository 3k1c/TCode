import { describe, expect, it } from "vitest";
import { splitUploadedAttachmentLine } from "./user-attachment-line";
describe("uploaded attachment display", () => {
  it("extracts composer upload paths without changing message text", () => {
    const a = "C:/data/uploads/11111111-2222-3333-4444-555555555555-annual report.pdf";
    const b = "C:/data/uploads/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-picture.png";
    expect(splitUploadedAttachmentLine("@" + a + " @" + b + "\nReview them")).toEqual({paths: [a,b], text: "Review them"});
  });
  it("keeps normal mentions unchanged", () => {
    expect(splitUploadedAttachmentLine("@someone hi")).toEqual({paths: [], text: "@someone hi"});
  });
});
