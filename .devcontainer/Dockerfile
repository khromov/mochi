FROM node:24-slim

ARG TZ
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest

# node:slim's base strips /usr/share/doc/* (dpkg path-exclude), but Debian ships
# fzf's shell-integration scripts (key-bindings.zsh / completion.zsh) there. Keep
# fzf's docs so those scripts actually land on disk and the zsh startup `source`
# lines (and the oh-my-zsh fzf plugin) resolve instead of erroring.
RUN echo 'path-include /usr/share/doc/fzf/*' > /etc/dpkg/dpkg.cfg.d/keep-fzf-docs

# Install basic development tools and iptables/ipset
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  wget \
  curl \
  ca-certificates \
  procps \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  gh \
  iptables \
  ipset \
  iproute2 \
  dnsutils \
  aggregate \
  jq \
  nano \
  vim \
  locales \
  tzdata \
  chromium \
  fonts-liberation \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# chrome-devtools-mcp resolves the default "stable" Chrome channel to
# /opt/google/chrome/chrome on Linux. Google ships no arm64 Chrome, so point that
# path at Debian's chromium. This keeps the committed .mcp.json free of a
# Linux-only --executablePath, so the same config also works on a macOS host
# (where puppeteer auto-detects the installed Google Chrome).
RUN mkdir -p /opt/google/chrome && ln -s /usr/bin/chromium /opt/google/chrome/chrome

# Generate the en_US.UTF-8 locale so bash/zsh stop warning about LC_ALL,
# and configure the system timezone from the TZ build arg.
RUN sed -i 's/^# *\(en_US.UTF-8 UTF-8\)/\1/' /etc/locale.gen && \
  locale-gen en_US.UTF-8 && \
  update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 && \
  ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime && \
  echo "$TZ" > /etc/timezone
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Ensure default node user has access to /usr/local/share
RUN mkdir -p /usr/local/share/npm-global && \
  chown -R node:node /usr/local/share

ARG USERNAME=node

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions
RUN mkdir -p /workspace /home/node/.claude && \
  chown -R node:node /workspace /home/node/.claude

WORKDIR /workspace

ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  sudo dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Set up non-root user
USER node

# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Set the default editor and visual
ENV EDITOR=nano
ENV VISUAL=nano

# Default powerline10k theme
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Install Claude
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Install Bun (pinned to the repo's .bun-version). Baked into the image at build
# time so it survives the runtime firewall, which blocks bun.com/bun.sh.
ARG BUN_VERSION=1.3.14
RUN curl -fsSL https://bun.com/install | bash -s "bun-v${BUN_VERSION}"
ENV BUN_INSTALL=/home/node/.bun
ENV PATH=$PATH:/home/node/.bun/bin

# Claude Code aliases. All run with permission prompts bypassed
# (--dangerously-skip-permissions) since this devcontainer is already isolated.
# The variants use `command claude` so they don't re-trigger the `claude` alias.
RUN printf '%s\n' \
  '' \
  '# Claude Code aliases' \
  'alias claude="claude --dangerously-skip-permissions"' \
  'alias cs="command claude --model sonnet --dangerously-skip-permissions"' \
  'alias c200="CLAUDE_CODE_DISABLE_1M_CONTEXT=1 command claude --dangerously-skip-permissions"' \
  'alias cs200="CLAUDE_CODE_DISABLE_1M_CONTEXT=1 command claude --model sonnet --dangerously-skip-permissions"' \
  | tee -a /home/node/.zshrc /home/node/.bashrc >/dev/null


# Copy custom Claude Code statusline script and portable global settings
# (both merged into ~/.claude/settings.json via postCreateCommand).
COPY statusline.sh /home/node/statusline.sh
COPY claude-settings.json /home/node/claude-settings.json
USER root
RUN chmod +x /home/node/statusline.sh && \
  chown node:node /home/node/statusline.sh /home/node/claude-settings.json
USER node

# Copy and set up firewall script
COPY init-firewall.sh /usr/local/bin/
USER root
RUN chmod +x /usr/local/bin/init-firewall.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \
  chmod 0440 /etc/sudoers.d/node-firewall
USER node
