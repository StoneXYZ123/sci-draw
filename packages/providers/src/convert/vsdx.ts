import { zipStore } from "./zip-store";

export class VsdxUnavailableError extends Error {
  readonly errorCode = "NOT_IMPLEMENTED" as const;

  constructor(message = "VSDX export is not available in this release") {
    super(message);
    this.name = "VsdxUnavailableError";
  }
}

export type VsdxProviderMode = "unavailable" | "mock" | "cloudconvert";

export type VsdxProviderEnv = {
  CONVERT_VSDX_PROVIDER?: string;
  CLOUDCONVERT_API_KEY?: string;
};

export function resolveVsdxProviderMode(env: VsdxProviderEnv): VsdxProviderMode {
  const requested = (env.CONVERT_VSDX_PROVIDER ?? "").trim().toLowerCase();
  if (requested === "" || requested === "none" || requested === "unimplemented") {
    return "unavailable";
  }
  if (requested === "mock") {
    return "mock";
  }
  if (requested === "cloudconvert") {
    return env.CLOUDCONVERT_API_KEY?.trim() ? "cloudconvert" : "unavailable";
  }
  return "unavailable";
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildMockVsdx(label: string): Uint8Array {
  const safe = xml(label.slice(0, 80) || "Figure");
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${safe}</dc:title>
  <dc:creator>sci-draw</dc:creator>
</cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>sci-draw</Application>
</Properties>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <DocumentSettings/>
</VisioDocument>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
</Relationships>`;
  const pages = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <Page ID="0" NameU="Page-1" Name="Page-1">
    <PageSheet>
      <Cell N="PageWidth" V="8.5"/>
      <Cell N="PageHeight" V="11"/>
    </PageSheet>
  </Page>
</Pages>`;
  const pagesRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`;
  const page = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xml:space="preserve">
  <Shapes>
    <Shape ID="1" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">
      <Cell N="PinX" V="4.25"/>
      <Cell N="PinY" V="5.5"/>
      <Cell N="Width" V="3"/>
      <Cell N="Height" V="1.2"/>
      <Text>${safe}</Text>
    </Shape>
  </Shapes>
</PageContents>`;
  const text = (value: string) => new TextEncoder().encode(value);
  return zipStore([
    { name: "[Content_Types].xml", data: text(contentTypes) },
    { name: "_rels/.rels", data: text(rootRels) },
    { name: "docProps/core.xml", data: text(core) },
    { name: "docProps/app.xml", data: text(app) },
    { name: "visio/document.xml", data: text(documentXml) },
    { name: "visio/_rels/document.xml.rels", data: text(documentRels) },
    { name: "visio/pages/pages.xml", data: text(pages) },
    { name: "visio/pages/_rels/pages.xml.rels", data: text(pagesRels) },
    { name: "visio/pages/page1.xml", data: text(page) },
  ]);
}

export function cloudConvertTaskBody(input: { filename: string; fileBase64: string }) {
  return {
    tasks: {
      "import-file": {
        operation: "import/base64",
        file: input.fileBase64,
        filename: input.filename,
      },
      "convert-file": {
        operation: "convert",
        input: ["import-file"],
        output_format: "vsdx",
      },
      "export-file": {
        operation: "export/url",
        input: ["convert-file"],
      },
    },
  };
}

type CloudConvertFile = { url?: string };
type CloudConvertTask = {
  name?: string;
  operation?: string;
  status?: string;
  message?: string;
  result?: { files?: CloudConvertFile[] };
};
type CloudConvertJob = {
  data?: {
    id?: string;
    status?: string;
    tasks?: CloudConvertTask[];
  };
};

function exportUrl(job: CloudConvertJob): string | null {
  const tasks = job.data?.tasks ?? [];
  for (const task of tasks) {
    if (task.operation !== "export/url" && task.name !== "export-file") {
      continue;
    }
    const url = task.result?.files?.[0]?.url;
    if (typeof url === "string" && url.startsWith("https://")) {
      return url;
    }
  }
  return null;
}

function taskError(job: CloudConvertJob): string | null {
  const tasks = job.data?.tasks ?? [];
  for (const task of tasks) {
    if (task.status === "error" && task.message) {
      return task.message.slice(0, 300);
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runCloudConvertVsdx(input: {
  bytes: Uint8Array;
  filename: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}): Promise<Uint8Array> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const pause = input.sleepImpl ?? sleep;
  const maxAttempts = input.maxAttempts ?? 30;
  const created = await fetchImpl("https://api.cloudconvert.com/v2/jobs", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(
      cloudConvertTaskBody({
        filename: input.filename,
        fileBase64: Buffer.from(input.bytes).toString("base64"),
      }),
    ),
  });
  if (!created.ok) {
    throw new Error(`CloudConvert rejected the VSDX job (${created.status})`);
  }
  const createdBody = (await created.json()) as CloudConvertJob;
  const jobId = createdBody.data?.id;
  if (!jobId) {
    throw new Error("CloudConvert did not return a job id");
  }
  let latest = createdBody;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (latest.data?.status === "finished") {
      break;
    }
    if (latest.data?.status === "error") {
      throw new Error(taskError(latest) ?? "CloudConvert could not convert the image to VSDX");
    }
    await pause(3_000);
    const polled = await fetchImpl(`https://api.cloudconvert.com/v2/jobs/${encodeURIComponent(jobId)}`, {
      headers: { authorization: `Bearer ${input.apiKey}` },
    });
    if (!polled.ok) {
      throw new Error(`CloudConvert job lookup failed (${polled.status})`);
    }
    latest = (await polled.json()) as CloudConvertJob;
  }
  if (latest.data?.status !== "finished") {
    throw new Error("CloudConvert did not finish the VSDX job");
  }
  const url = exportUrl(latest);
  if (!url) {
    throw new Error("CloudConvert finished without a VSDX download");
  }
  const downloaded = await fetchImpl(url);
  if (!downloaded.ok) {
    throw new Error(`CloudConvert download failed (${downloaded.status})`);
  }
  return new Uint8Array(await downloaded.arrayBuffer());
}

export async function convertImageToVsdx(input: {
  bytes: Uint8Array;
  filename: string;
  env: VsdxProviderEnv;
  fetchImpl?: typeof fetch;
}): Promise<Uint8Array> {
  const mode = resolveVsdxProviderMode(input.env);
  switch (mode) {
    case "unavailable":
      throw new VsdxUnavailableError();
    case "mock":
      return buildMockVsdx(input.filename);
    case "cloudconvert": {
      const apiKey = input.env.CLOUDCONVERT_API_KEY?.trim() ?? "";
      if (!apiKey) {
        throw new VsdxUnavailableError();
      }
      return runCloudConvertVsdx({
        bytes: input.bytes,
        filename: input.filename,
        apiKey,
        fetchImpl: input.fetchImpl,
      });
    }
    default: {
      const neverMode: never = mode;
      throw new Error(`Unhandled VSDX provider ${neverMode}`);
    }
  }
}
