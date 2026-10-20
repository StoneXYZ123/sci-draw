export type PublicJobStatus = "queued" | "processing" | "succeeded" | "failed" | "canceled";

export type PublicFile = { url: string; format: string };

export type PublicJobView = {
  id: string;
  object: "job";
  type: string;
  status: PublicJobStatus;
  credits_reserved: number;
  credits_consumed: number;
  result: { files: PublicFile[] } | null;
  error: { code: string; message: string } | null;
};

const JOB_STATUSES = ["pending", "running", "completed", "failed", "canceled"] as const;
type StoredStatus = (typeof JOB_STATUSES)[number];

function isStoredStatus(value: string): value is StoredStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

export function toPublicStatus(status: string): PublicJobStatus {
  if (!isStoredStatus(status)) {
    return "failed";
  }
  switch (status) {
    case "pending":
      return "queued";
    case "running":
      return "processing";
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

function publicType(type: string, request: unknown): string {
  if (type === "generate") {
    const mode = typeof request === "object" && request !== null && "mode" in request ? request.mode : "";
    if (mode === "sketch" || mode === "replicate") {
      return "image.edit";
    }
    return "image.generation";
  }
  switch (type) {
    case "public_convert":
    case "convert_vsdx":
      return "image.conversion";
    case "public_chart":
    case "sci_vis":
      return "chart.generation";
    case "sci_vis_xlsx":
      return "chart.export";
    default:
      return "job";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pushFile(files: PublicFile[], url: unknown, format: unknown): void {
  if (typeof url !== "string" || typeof format !== "string" || format === "code" || url.length === 0) {
    return;
  }
  if (files.some((file) => file.url === url && file.format === format)) {
    return;
  }
  files.push({ url, format });
}

export function filesFromResult(result: unknown): PublicFile[] {
  const record = asRecord(result);
  if (!record) {
    return [];
  }
  const files: PublicFile[] = [];
  if (Array.isArray(record.files)) {
    for (const file of record.files) {
      const item = asRecord(file);
      if (item) {
        pushFile(files, item.url, item.format);
      }
    }
  }
  const data = asRecord(record.data);
  if (data && Array.isArray(data.results)) {
    for (const item of data.results) {
      const row = asRecord(item);
      if (row) {
        pushFile(files, row.imageUrl, "png");
      }
    }
  }
  const formats = asRecord(record.formats);
  if (formats) {
    for (const [format, url] of Object.entries(formats)) {
      pushFile(files, url, format);
    }
  }
  pushFile(files, record.xlsxUrl, "xlsx");
  pushFile(files, record.vsdxUrl, "vsdx");
  pushFile(files, record.imageUrl, "png");
  return files;
}

export function toPublicJob(row: {
  id: string;
  type: string;
  status: string;
  request: unknown;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  creditsReserved: number;
  creditsConsumed: number;
}): PublicJobView {
  const status = toPublicStatus(row.status);
  const files = status === "succeeded" ? filesFromResult(row.result) : [];
  return {
    id: row.id,
    object: "job",
    type: publicType(row.type, row.request),
    status,
    credits_reserved: row.creditsReserved,
    credits_consumed: row.creditsConsumed,
    result: status === "succeeded" ? { files } : null,
    error:
      status === "failed" || status === "canceled"
        ? { code: row.errorCode ?? "JOB_FAILED", message: row.errorMessage ?? "The job failed" }
        : null,
  };
}
