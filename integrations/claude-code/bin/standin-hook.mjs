#!/usr/bin/env node
// standin-hook <event>: reads hook JSON on stdin. lib/ is copied from integrations/common at install.
import { runCli } from '../lib/hooks.mjs';
runCli('claude-code');
