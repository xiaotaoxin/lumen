"use client";

import { motion } from "framer-motion";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  id: string;
  label: string;
  description?: string;
  href?: string;
}

interface StepperProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export function Stepper({ steps, currentStep, className }: StepperProps) {
  return (
    <nav className={cn("flex items-center gap-0", className)} aria-label="Progress">
      {steps.map((step, i) => {
        const isCompleted = i < currentStep;
        const isCurrent = i === currentStep;
        const isLast = i === steps.length - 1;

        return (
          <div key={step.id} className="flex items-center">
            <motion.div
              className="flex items-center gap-2"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1, duration: 0.3 }}
            >
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors",
                  isCompleted && "bg-brand-500 text-white",
                  isCurrent && "bg-brand-500/20 text-brand-600 ring-2 ring-brand-500/40",
                  !isCompleted && !isCurrent && "bg-muted text-muted-foreground",
                )}
              >
                {isCompleted ? <Check className="size-3.5" /> : i + 1}
              </div>
              <div className="hidden sm:flex flex-col">
                <span className={cn("text-xs font-medium", (isCompleted || isCurrent) ? "text-foreground" : "text-muted-foreground")}>
                  {step.label}
                </span>
                {step.description && (
                  <span className="text-[10px] text-muted-foreground">{step.description}</span>
                )}
              </div>
            </motion.div>
            {!isLast && (
              <div
                className={cn(
                  "mx-2 h-px w-6 sm:w-10 transition-colors",
                  isCompleted ? "bg-brand-500" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
