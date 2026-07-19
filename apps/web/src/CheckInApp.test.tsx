import type { CheckInResponse } from "@live-check-in-demo/shared";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckIn, sendHeartbeat } from "./api-client";
import { CheckInApp } from "./CheckInApp";

vi.mock("./api-client", () => ({
  createCheckIn: vi.fn(),
  sendHeartbeat: vi.fn(),
}));

const mockedCreateCheckIn = vi.mocked(createCheckIn);
const mockedSendHeartbeat = vi.mocked(sendHeartbeat);

function session(
  expiresAt = new Date(Date.now() + 60_000).toISOString(),
): CheckInResponse {
  return {
    sessionToken: "payload.signature",
    expiresAt,
    heartbeatIntervalMs: 3_000,
  };
}

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("CheckInApp", () => {
  it("shows the single check-in action", () => {
    render(<CheckInApp />);

    expect(
      screen.getByRole("heading", { name: "발표 데모에 참여해 주세요." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "참여하기" })).toBeEnabled();
  });

  it("starts one session, disables duplicate clicks, and sends a heartbeat", async () => {
    mockedCreateCheckIn.mockResolvedValue(session());
    mockedSendHeartbeat.mockResolvedValue({
      ok: true,
      receivedAt: new Date().toISOString(),
      servedBy: "test-api",
    });
    render(<CheckInApp />);
    const button = screen.getByRole("button", { name: "참여하기" });

    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedCreateCheckIn).toHaveBeenCalledTimes(1);
    expect(mockedSendHeartbeat).toHaveBeenCalledTimes(1);
    expect(mockedSendHeartbeat).toHaveBeenCalledWith(
      "payload.signature",
      expect.any(AbortSignal),
    );
    expect(screen.getByText("✓ 참여 중 · 연결됨")).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("waits for each heartbeat before scheduling the next one", async () => {
    vi.useFakeTimers();
    let resolveFirst: (
      value: Awaited<ReturnType<typeof sendHeartbeat>>,
    ) => void = () => undefined;
    mockedCreateCheckIn.mockResolvedValue(session());
    mockedSendHeartbeat
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({
        ok: true,
        receivedAt: new Date().toISOString(),
        servedBy: "task-b",
      });
    render(<CheckInApp />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "참여하기" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(mockedSendHeartbeat).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({
        ok: true,
        receivedAt: new Date().toISOString(),
        servedBy: "task-a",
      });
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(mockedSendHeartbeat).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mockedSendHeartbeat).toHaveBeenCalledTimes(2);
  });

  it("retains the latest servedBy value as development metadata", async () => {
    mockedCreateCheckIn.mockResolvedValue(session());
    mockedSendHeartbeat.mockResolvedValue({
      ok: true,
      receivedAt: new Date().toISOString(),
      servedBy: "task-b",
    });
    render(<CheckInApp />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "참여하기" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen
        .getByRole("heading", { name: "발표 데모에 참여해 주세요." })
        .closest("section"),
    ).toHaveAttribute("data-served-by", "task-b");
  });

  it("moves to completed after the session expires", async () => {
    vi.useFakeTimers();
    mockedCreateCheckIn.mockResolvedValue(
      session(new Date(Date.now() + 100).toISOString()),
    );
    mockedSendHeartbeat.mockResolvedValue({
      ok: true,
      receivedAt: new Date().toISOString(),
      servedBy: "test-api",
    });
    render(<CheckInApp />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "참여하기" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByText("✓ 참여 완료")).toBeInTheDocument();
    expect(window.localStorage.getItem("live-check-in-session")).toBeNull();
  });

  it("shows an error when check-in cannot be created", async () => {
    mockedCreateCheckIn.mockRejectedValue(new Error("offline"));
    render(<CheckInApp />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "참여하기" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("참여하지 못했습니다");
  });

  it("aborts an in-flight heartbeat on unmount", async () => {
    let heartbeatSignal: AbortSignal | undefined;
    mockedCreateCheckIn.mockResolvedValue(session());
    mockedSendHeartbeat.mockImplementation((_sessionToken, signal) => {
      heartbeatSignal = signal;
      return new Promise(() => undefined);
    });
    const view = render(<CheckInApp />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "참여하기" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    view.unmount();

    expect(heartbeatSignal?.aborted).toBe(true);
  });

  it("does not persist a session when creation resolves after unmount", async () => {
    let resolveCreate = (_value: CheckInResponse): void => undefined;
    mockedCreateCheckIn.mockReturnValue(
      new Promise<CheckInResponse>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const view = render(<CheckInApp />);

    fireEvent.click(screen.getByRole("button", { name: "참여하기" }));
    view.unmount();
    resolveCreate(session());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.localStorage.getItem("live-check-in-session")).toBeNull();
    expect(mockedSendHeartbeat).not.toHaveBeenCalled();
  });

  it("starts one restored heartbeat loop under StrictMode", async () => {
    window.localStorage.setItem(
      "live-check-in-session",
      JSON.stringify(session()),
    );
    mockedSendHeartbeat.mockResolvedValue({
      ok: true,
      receivedAt: new Date().toISOString(),
      servedBy: "test-api",
    });

    render(
      <StrictMode>
        <CheckInApp />
      </StrictMode>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedSendHeartbeat).toHaveBeenCalledTimes(1);
  });
});
