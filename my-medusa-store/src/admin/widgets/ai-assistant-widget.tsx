import { Widget, Text, Input, Button, Container } from "@medusajs/ui";
import { useAdminCustomQuery, useAdminCustomPost } from "medusa-react";
import React, { useState } from "react";

const AIAssistantWidget = () => {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { mutate } = useAdminCustomPost("/custom/ask-ai", ["ask-ai"]);

  const handleAsk = () => {
    if (!question.trim()) {
      return;
    }
    setIsLoading(true);
    mutate(
      { question },
      {
        onSuccess: (data) => {
          setAnswer(data.answer);
          setIsLoading(false);
        },
        onError: (error) => {
          console.error("Error asking AI:", error);
          setAnswer("Der opstod en fejl. Prøv igen.");
          setIsLoading(false);
        },
      }
    );
  };

  return (
    <Widget>
      <Container>
        <Text size="xlarge" weight="bold" as="h2" className="mb-4">
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
            <Text weight="bold">Svar:</Text>
            <Text>{answer}</Text>
          </div>
        )}
      </Container>
    </Widget>
  );
};

export default AIAssistantWidget;