/** The one OpenAI model every call uses (chat, Brief, extraction, resolve, research). */
export function openaiModel(): string {
  const model = process.env.OPENAI_MODEL?.trim();
  if (!model) throw new Error("OPENAI_MODEL is not set");
  return model;
}
