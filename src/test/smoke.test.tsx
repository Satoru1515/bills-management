import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>;
}

describe("test setup", () => {
  it("renders React components with jsdom and jest-dom matchers", () => {
    render(<Greeting name="Satoru" />);
    expect(screen.getByText("Hello, Satoru")).toBeInTheDocument();
  });
});
