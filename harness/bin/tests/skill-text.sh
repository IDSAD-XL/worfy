# Sourced by the Harness shell tests that check the text of a skill or of an agent definition.
#
#   skill_text <SKILL.md or agents/<name>.md> <out file>
#
# Writes the text as an agent reads it in full: the file with every pointer line to a step file —
# a line that starts, after its indentation, with
#   Read `${CLAUDE_PLUGIN_ROOT}/skills/<skill>/<file>`
# — replaced by that step file without its title line and the blank line after it (and without its
# "Plugin root:" line and the blank line after that, when it has one), each of its lines
# indented like the pointer line. The step file is looked up next to a SKILL.md of that skill, or in
# ../skills/<skill>/ from an agent definition. A step moved out of the file to keep the agents'
# starting context small (bin/start-context) is then checked where the text puts it, by the same
# checks as before the move. A pointer to a missing file stays as it is, so the checks of the moved
# text go red. Returns non-zero when the file cannot be read.
# Perl, not node: Git Bash hands perl its own /c/… paths, which node on Windows cannot open.
skill_text() {
    perl -e '
        my ($file, $out) = @ARGV;
        (my $dir = $file) =~ s{/[^/]*$}{};
        $dir = "." if $dir eq $file;
        (my $base = $dir) =~ s{.*/}{};
        open my $in, "<:raw", $file or die "skill_text: cannot read $file: $!\n";
        local $/; my $text = <$in>; close $in;
        my @lines = split /\n/, $text, -1;
        for my $line (@lines) {
            next unless $line =~ m{^( *)Read `\$\{CLAUDE_PLUGIN_ROOT\}/skills/([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)`};
            my ($indent, $skill, $name) = ($1, $2, $3);
            my $step = $base eq $skill ? "$dir/$name" : "$dir/../skills/$skill/$name";
            next unless -f $step;
            open my $s, "<:raw", $step or next;
            my $body = <$s>; close $s;
            my @b = split /\n/, $body, -1;
            @b = @b[2 .. $#b];
            @b = @b[2 .. $#b] if @b > 1 && $b[0] =~ /^Plugin root: / && $b[1] eq "";
            pop @b while @b && $b[-1] eq "";
            $line = join "\n", map { $_ eq "" ? "" : "$indent$_" } @b;
        }
        open my $o, ">:raw", $out or die "skill_text: cannot write $out: $!\n";
        print $o join("\n", @lines);
        close $o;
    ' "$1" "$2"
}
