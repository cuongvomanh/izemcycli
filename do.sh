usr=cuongvm
fn=2-5-Steps_636712202000421116.pdf
dir="$usr-$fn"
freq_f="freq.txt"
html_f=outfile-$dir.html
txt_f=output-$dir.txt
hl_f=hl.js
css_f=style.css

cp $hl_f $dir
cp $css_f $dir
n_hl_f="$dir/$hl_f"
if [[ ! -d $dir ]];then
	mkdir $dir
	cd $dir
	pdftohtml -enc UTF-8 -noframes ../$fn  $html_f
	pdftotext -layout ../$fn $txt_f
	sed -i '/<\/body>/i <script src="hl.js"><\/script>' $html_f
	sed -i '/<\/style>/a <link rel="stylesheet" type="text\/css" href=".\/style.css">' $html_f
else
	cd $dir
	cat $txt_f | tr ' ' '\n' | sort | uniq -c | sort -n > $freq_f
	le1=50 && le2=100 
	le1_f=le1.txt && le2_f=le2.txt && le3_f=le3.txt
	cat $freq_f | awk '{if ($1 < 10){print $2}}' |  grep '^[A-Za-z0-9-]*$'> $le1_f
	cat $freq_f | awk '{if ($1 < 50 && $1 > 10){print $2}}' > $le2_f
	cat $freq_f | awk '{if ($1 > 50){print $2}}' > $le3_f
fi


for f in $(cat $le3_f);do 
	echo -e "findAndReplaceDOMText(document.body, {\n  find: ' "$f" ',\n  wrap: 'span',\n  wrapClass: 'shiny'\n  }\n);" >> $hl_f
done
for f in $(cat $le1_f);do 
	echo -e "findAndReplaceDOMText(document.body, {\n  find: ' "$f" ',\n  wrap: 'span',\n  wrapClass: 'redc'\n  }\n);" >> $hl_f
done
for f in $(cat $le2_f);do 
	echo -e "findAndReplaceDOMText(document.body, {\n  find: ' "$f" ',\n  wrap: 'span',\n  wrapClass: 'greenc'\n  }\n);" >> $hl_f
done
