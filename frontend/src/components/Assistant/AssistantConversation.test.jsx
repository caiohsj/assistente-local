import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AssistantConversation from "./AssistantConversation.jsx";

describe("AssistantConversation", () => {
  it("renderiza Markdown nas respostas e texto simples nas mensagens do usuário", () => {
    const { container } = render(
      <AssistantConversation
        messages={[
          { id: 1, role: "user", content: "**não é negrito**" },
          {
            id: 2,
            role: "assistant",
            content: "**é negrito**\n\n- item",
          },
        ]}
      />
    );

    // Usuário: markdown permanece literal.
    expect(screen.getByText("**não é negrito**").tagName).toBe("P");
    // Assistente: markdown viu elementos HTML.
    expect(screen.getByText("é negrito").tagName).toBe("STRONG");
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });
});
