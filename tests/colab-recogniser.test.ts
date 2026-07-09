import { describe, expect, it } from "vitest";
import { isColabUrl, recogniseColabSignals } from "../src/recognisers/colab.js";

describe("colab recogniser", () => {
  it("identifies Google Colab URLs", () => {
    expect(isColabUrl("https://colab.research.google.com/drive/abc")).toBe(true);
    expect(isColabUrl("https://example.com/not-colab")).toBe(false);
  });

  it("identifies notebook and delegated execution semantics", () => {
    const content = `
{
  "metadata": {"kernelspec": {"name": "python3"}},
  "cells": [
    {"cell_type": "markdown", "source": ["# test"]},
    {"cell_type": "code", "source": ["import requests", "requests.post(\\"https://api.github.com/repos/org/repo/issues\\")"]},
    {"cell_type": "code", "source": ["run all"]}
  ]
}
`;
    const result = recogniseColabSignals(
      "https://colab.research.google.com/drive/abc",
      content
    );
    const titles = result.findings.map((f) => f.title);
    expect(titles).toContain("Notebook document indicators detected");
    expect(titles).toContain("Executable Python cell indicators detected");
    expect(titles).toContain("Delegated execution indicator detected");
    expect(result.signals.notebookExecuted).toBe(true);
    expect(result.signals.networkingCode).toBe(true);
    expect(result.detectedCapabilities).toEqual(expect.arrayContaining(["requests", "api.github.com"]));
    expect(result.trustBoundaryCrossings).toContain("saas-control-plane->managed-runtime");
  });

  it("detects markdown and metadata notebook signals", () => {
    const content = `
{
  "metadata": {"language_info": {"name": "python"}},
  "cells": [
    {"cell_type": "markdown", "source": ["# Intro"]},
    {"cell_type": "code", "source": ["print('ok')"]}
  ]
}
`;
    const result = recogniseColabSignals("https://colab.research.google.com/github/org/repo/blob/main/a.ipynb", content);
    expect(result.signals.markdownCell).toBe(true);
    expect(result.signals.notebookMetadata).toBe(true);
    expect(result.signals.isNotebookDocument).toBe(true);
  });
});
