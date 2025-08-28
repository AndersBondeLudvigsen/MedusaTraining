import { Text, Input, Button, Container } from "@medusajs/ui";
import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { useState } from "react";

const AIAssistantWidget = () => {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Orders count section
  const [lastInput, setLastInput] = useState("7d");
  const [countLoading, setCountLoading] = useState(false);
  const [countResult, setCountResult] = useState<{
    count: number;
    from?: string;
    to?: string;
  } | null>(null);
  const [countError, setCountError] = useState<string | null>(null);

  const handleAsk = async () => {
    if (!question.trim()) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/admin/custom/ask-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ question }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Request failed with ${res.status}`);
      }
      const data = await res.json();
      setAnswer(data?.answer ?? "");
    } catch (error) {
      console.error("Error asking AI:", error);
      setAnswer("Der opstod en fejl. Prøv igen.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCountOrders = async () => {
    const last = lastInput.trim();
    if (!last) return;
    setCountLoading(true);
    setCountError(null);
    setCountResult(null);
    try {
      const url = new URL("/admin/stats/orders-count", window.location.origin);
      url.searchParams.set("last", last);
      const res = await fetch(url.toString(), {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Request failed with ${res.status}`);
      }
      const data = await res.json();
      const count = Number(data?.count ?? 0);
      const from = data?.range?.from as string | undefined;
      const to = data?.range?.to as string | undefined;
      setCountResult({ count, from, to });
    } catch (e: any) {
      setCountError(e?.message || "Kunne ikke hente ordretælling.");
    } finally {
      setCountLoading(false);
    }
  };

  return (
    <Container>
      <Text size="xlarge" weight="plus" className="mb-4">
        AI Salgsassistent 🤖
      </Text>
      <Text className="mb-4">
        Stil et spørgsmål om dine salgsdata, og få et hurtigt svar.
      </Text>
      <div className="flex gap-x-2">
        <Input
          placeholder="F.eks. Hvad var vores bedst sælgende produkt i sidste uge?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={isLoading}
        />
        <Button onClick={handleAsk} isLoading={isLoading}>
          Spørg
        </Button>
      </div>

      {isLoading && (
        <div className="mt-4 p-4 bg-grey-5 rounded-lg">
          <Text>Tænker...</Text>
        </div>
      )}

      {answer && !isLoading && (
        <div className="mt-4 p-4 bg-grey-5 rounded-lg">
          <Text weight="plus">Svar:</Text>
          <Text>{answer}</Text>
        </div>
      )}

      {/* Orders count mini-tool */}
      <div className="mt-6">
        <Text size="large" weight="plus" className="mb-2">
          Ordretælling i periode
        </Text>
        <div className="flex gap-x-2 items-center">
          <Input
            placeholder="Fx 7d, 24h, 30d"
            value={lastInput}
            onChange={(e) => setLastInput(e.target.value)}
            disabled={countLoading}
          />
          <Button onClick={handleCountOrders} isLoading={countLoading}>
            Tæl ordrer
          </Button>
        </div>
        {countLoading && (
          <div className="mt-3 p-3 bg-grey-5 rounded-lg">
            <Text>Henter...</Text>
          </div>
        )}
        {countError && !countLoading && (
          <div className="mt-3 p-3 bg-rose-50 rounded-lg">
            <Text>{countError}</Text>
          </div>
        )}
        {countResult && !countLoading && (
          <div className="mt-3 p-3 bg-grey-5 rounded-lg">
            <Text>
              Antal ordrer: <b>{countResult.count}</b>
            </Text>
            {countResult.from && countResult.to && (
              <Text className="text-grey-50">
                Periode: {new Date(countResult.from).toLocaleString()} – {new Date(countResult.to).toLocaleString()}
              </Text>
            )}
          </div>
        )}
      </div>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "order.list.before",
});

export default AIAssistantWidget;