#!/bin/bash
# builds javascript files Freeciv-web and copies the resulting file to tomcat.

printf "\nPrior to running this script, do the command:\nsudo -i\ncd /home/freeciv/freeciv-web/freeciv-web\nOR, cat the file and do the commands on the command line."

ulimit -c unlimited
sudo bash -c 'echo /tmp/core.%e.%p.%h.%t > /proc/sys/kernel/core_pattern'