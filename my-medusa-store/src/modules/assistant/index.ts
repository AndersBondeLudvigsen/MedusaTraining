import AssistantModuleService from "./service"
import { Module } from "@medusajs/framework/utils"

export const ASSISTANT_MODULE = "assistant"

export default Module(ASSISTANT_MODULE, {
  service: AssistantModuleService,
})

