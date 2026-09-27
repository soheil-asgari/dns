
# .       (UFW iptables  nftables)
sudo ufw disable
sudo iptables -F
sudo iptables X
sudo iptables -P INPUT ACCEPT
sudo iptables -P FORWARD ACCEPT
sudo iptables -P OUTPUT ACCEPT
sudo nft flush ruleset

# .       (Policy Routing)
#      119.97      eth2 
sudo ip rule add from 185.226.119.97 table 100 2>/dev/null
sudo ip route add default via 185.226.116.1 dev eth2 table 100 2>/dev/null
sudo ip route replace default via 185.226.116.1 dev eth2

# .       
sudo sysctl -w net.ipv4.conf.all.rp_filter=0
sudo sysctl -w net.ipv4.conf.eth1.rp_filter=0
sudo sysctl -w net.ipv4.conf.eth2.rp_filter=0

# .   SSH
sudo systemctl restart ssh
