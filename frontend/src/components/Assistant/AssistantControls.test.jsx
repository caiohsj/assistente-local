import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssistantControls from "./AssistantControls.jsx";

function setup(props = {}) {
  const onChange = vi.fn();
  const onSend = vi.fn().mockResolvedValue({ ok: true, clearInput: true });
  const onClearError = vi.fn();
  render(
    <AssistantControls
      value=""
      onChange={onChange}
      onSend={onSend}
      onClearError={onClearError}
      {...props}
    />
  );
  return { onChange, onSend, onClearError };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AssistantControls", () => {
  it("campo ativo repassa a digitação", () => {
    const { onChange } = setup();
    const field = screen.getByLabelText("Campo de mensagem");
    expect(field).toBeEnabled();

    fireEvent.change(field, { target: { value: "olá" } });
    expect(onChange).toHaveBeenCalledWith("olá");
  });

  it("Enter envia e Shift+Enter apenas quebra linha", async () => {
    const { onChange, onSend } = setup({ value: "oi" });
    const field = screen.getByLabelText("Campo de mensagem");

    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith(
        "oi",
        expect.objectContaining({ onAccepted: expect.any(Function) })
      )
    );
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("botão de envio desabilita com campo vazio e durante envio", () => {
    const { rerender } = render(
      <AssistantControls value="" onChange={vi.fn()} onSend={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeDisabled();

    rerender(<AssistantControls value="oi" onChange={vi.fn()} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeEnabled();

    rerender(
      <AssistantControls value="oi" onChange={vi.fn()} onSend={vi.fn()} sending />
    );
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeDisabled();
  });

  it("limpa o campo no aceite, antes da resposta do backend", async () => {
    let resolveSend;
    const onSend = vi.fn((_value, { onAccepted }) => {
      onAccepted();
      return new Promise((resolve) => { resolveSend = resolve; });
    });

    function Harness() {
      const [value, setValue] = useState("oi");
      return (
        <AssistantControls
          value={value}
          onChange={setValue}
          onSend={onSend}
          onClearInput={(sent) =>
            setValue((current) => (current === sent ? "" : current))
          }
        />
      );
    }

    render(<Harness />);
    const field = screen.getByLabelText("Campo de mensagem");
    fireEvent.keyDown(field, { key: "Enter" });

    expect(field).toHaveValue("");
    expect(onSend.mock.calls[0][1].onAccepted).toBeTypeOf("function");

    await act(async () => {
      resolveSend({ ok: true, clearInput: true });
    });
    expect(field).toHaveValue("");
  });

  it("não apaga mensagem digitada enquanto o envio estava em voo", async () => {
    let resolveSend;
    const onSend = vi.fn(() => new Promise((resolve) => { resolveSend = resolve; }));

    function Harness() {
      const [value, setValue] = useState("oi");
      return (
        <AssistantControls
          value={value}
          onChange={setValue}
          onSend={onSend}
          onClearInput={(sent) =>
            setValue((current) => (current === sent ? "" : current))
          }
        />
      );
    }

    render(<Harness />);
    const field = screen.getByLabelText("Campo de mensagem");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith(
        "oi",
        expect.objectContaining({ onAccepted: expect.any(Function) })
      )
    );

    fireEvent.change(field, { target: { value: "próxima" } });
    await act(async () => {
      resolveSend({ ok: true, clearInput: true });
    });
    expect(field).toHaveValue("próxima");
  });

  it("mantém o texto quando o backend não confirmou o recebimento", async () => {
    const onChange = vi.fn();
    const onSend = vi.fn().mockResolvedValue({ ok: false, clearInput: false });
    render(<AssistantControls value="oi" onChange={onChange} onSend={onSend} />);

    fireEvent.keyDown(screen.getByLabelText("Campo de mensagem"), { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalledWith("");
  });

  it("microfone permanece desabilitado e erro aparece como alerta", () => {
    setup({ error: "Backend local indisponível." });
    expect(screen.getByRole("button", { name: "Microfone (em breve)" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Backend local indisponível.");
  });
});
