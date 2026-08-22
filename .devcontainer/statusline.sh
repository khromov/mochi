#!/bin/bash
input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name // "Unknown model"')
cost=$(echo "$input" | jq -r '(.cost.total_cost_usd // 0) | . * 100 | round / 100')
used_percentage=$(echo "$input" | jq -r '.context_window.used_percentage // 0')
working_dir=$(echo "$input" | jq -r '.cwd')

# Shorten path by replacing home directory with ~
working_dir="${working_dir/#$HOME/~}"

printf "\033[38;5;208m※ Model: %s\033[0m \033[32m¤ Session cost: \$%.2f\033[0m \033[36m◐ Context: %.0f%% full\033[0m \033[35m⌂ %s\033[0m" "$model" "$cost" "$used_percentage" "$working_dir"
