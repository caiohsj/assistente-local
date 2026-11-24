import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownMessage from "./MarkdownMessage.jsx";

describe("MarkdownMessage", () => {
  it("renderiza negrito, listas e código", () => {
    const { container } = render(
      <MarkdownMessage
        content={"**Atenção**: use\n\n1. `htop`\n2. `top`\n\n```bash\nglances\n```"}
      />
    );

    expect(screen.getByText("Atenção").tagName).toBe("STRONG");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(screen.getByText("htop").tagName).toBe("CODE");
    const block = container.querySelector("pre code");
    expect(block).toHaveTextContent("glances");
    expect(block.className).toContain("language-bash");
  });

  it("não interpreta HTML cru", () => {
    const { container } = render(
      <MarkdownMessage content={'<img src=x onerror="alert(1)">\n\ntexto'} />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("<img");
  });

  it("abre links com noopener", () => {
    render(<MarkdownMessage content={"[docs](https://example.com)"} />);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
