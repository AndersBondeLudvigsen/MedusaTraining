import { Text, Input, Button, Container } from "@medusajs/ui";
import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { useState } from "react";

const AIAssistantWidget = () => {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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

      {answer && (
        <div className="mt-4 p-4 bg-grey-5 rounded-lg">
          <Text weight="plus">Svar:</Text>
          <Text>{answer}</Text>
        </div>
      )}
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "order.list.before",
});

export default AIAssistantWidget;