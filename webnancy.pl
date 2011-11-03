#!/usr/bin/perl -T
# Web wrapper for Nancy
# (c) 2002-2010 Reuben Thomas (rrt@sc3d.org, http://rrt.sc3d.org)
# Distributed under the GNU General Public License

use strict;
use warnings;

use File::Spec::Functions qw(catfile);
use CGI qw(:standard);
use CGI::Util qw(unescape);

use WWW::Nancy;

# Root of site relative to root of server
my $BaseUrl = "/";
# Root of source files
my $DocumentRoot = "/var/www";
# Template
my $Template = "template";

# Extract file name from URL
my $page = unescape(url(-absolute => 1));
$page =~ s|^$BaseUrl/?||;
$page = "index.html" if $page eq "";
$page =~ m/\.[^.]*$/;
my $ext = $_;
# FIXME: Look in the tree to check 404
($Template, $ext) = ("404", "html") if !-d catfile($DocumentRoot, $page);

# Output page
print header() . WWW::Nancy::expand("\$include{$Template$ext}", $page, $DocumentRoot);
